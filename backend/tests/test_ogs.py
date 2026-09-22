import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from fastapi import HTTPException
from app.routers.ogs import import_ogs, MAX_BYTES


class OgsImportTests(unittest.TestCase):
    @patch('app.routers.ogs.build_opener')
    def test_download_is_bounded_and_uses_fixed_host(self, opener):
        response = opener.return_value.open.return_value.__enter__.return_value
        response.read.return_value = b'(;GM[1]SZ[19];B[aa])'
        result = import_ogs(123)
        self.assertEqual(result.body, response.read.return_value)
        request = opener.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://online-go.com/api/v1/games/123/sgf')
        response.read.assert_called_once_with(MAX_BYTES + 1)
        self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 15)

    @patch('app.routers.ogs.build_opener')
    def test_upstream_errors(self, opener):
        for upstream, expected in [(403, 403), (404, 404), (429, 429), (302, 502), (500, 502)]:
            opener.return_value.open.side_effect = HTTPError('https://online-go.com', upstream, '', {}, None)
            with self.assertRaises(HTTPException) as error:
                import_ogs(123)
            self.assertEqual(error.exception.status_code, expected)
        opener.return_value.open.side_effect = URLError('timeout')
        with self.assertRaises(HTTPException) as error:
            import_ogs(123)
        self.assertEqual(error.exception.status_code, 504)

    @patch('app.routers.ogs.build_opener')
    def test_rejects_html_and_oversize(self, opener):
        response = opener.return_value.open.return_value.__enter__.return_value
        for content, status in [(b'<html>login</html>', 502), (b'x' * (MAX_BYTES + 1), 413)]:
            response.read.return_value = content
            with self.assertRaises(HTTPException) as error:
                import_ogs(123)
            self.assertEqual(error.exception.status_code, status)
