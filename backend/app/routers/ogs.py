"""Public OGS imports. Only a numeric ID can select the upstream resource."""
import socket
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import Response

router = APIRouter()
MAX_BYTES = 5 * 1024 * 1024


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@router.get('/api/ogs/{game_id}/sgf')
def import_ogs(game_id: int = Path(..., ge=1, le=9007199254740991)):
    request = Request(
        f'https://online-go.com/api/v1/games/{game_id}/sgf',
        headers={'Accept': 'application/x-go-sgf', 'User-Agent': 'GoReview/1.0'},
    )
    try:
        with build_opener(NoRedirects()).open(request, timeout=15) as response:
            content = response.read(MAX_BYTES + 1)
    except HTTPError as error:
        status = error.code if error.code in (403, 404, 429) else 502
        raise HTTPException(status, 'OGS game unavailable. Private games require an SGF upload.') from error
    except (URLError, TimeoutError, socket.timeout) as error:
        raise HTTPException(504, 'OGS could not be reached. Try again or upload an SGF.') from error
    if len(content) > MAX_BYTES:
        raise HTTPException(413, 'SGF exceeds the 5 MB import limit.')
    if not content.lstrip(b'\xef\xbb\xbf \t\r\n').startswith(b'(;'):
        raise HTTPException(502, 'OGS did not return an SGF game.')
    return Response(content, media_type='application/x-go-sgf')
