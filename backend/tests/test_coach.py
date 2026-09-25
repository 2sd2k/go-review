import asyncio
import io
import json
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.coach import CoachRequest, ask_coach, engine_facts, generate_answer


def example_request(question='Why was this move bad?'):
    return CoachRequest.model_validate({
        'question': question,
        'position': {
            'move_number': 1, 'board_size': 9,
            'board_rows': ['B........'] + ['.........'] * 8,
            'next_player': 'W', 'mover': 'B', 'played_move': 'A9',
            'quality': 'mistake', 'point_loss': 3.2, 'win_rate_loss': 0.08,
            'prior': {'win_rate': 0.52, 'score_lead': 1.0,
                      'top_moves': [{'move': 'C4', 'win_rate': 0.56, 'score_lead': 2.1,
                                     'visits': 100, 'pv': ['C4', 'D4']}]},
            'current': {'win_rate': 0.44, 'score_lead': -2.2, 'top_moves': []},
            'recent_moves': ['B A9'],
        },
    })


class CoachTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_candidate_does_not_call_model(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'secret'}), patch('app.routers.coach.generate_answer') as generate:
            answer = await ask_coach(example_request('Why not R7?'))
        self.assertIn('has not evaluated', answer['answer'])
        self.assertIn('KataGo preferred C4', ' '.join(answer['engine_facts']))
        generate.assert_not_called()

    async def test_key_is_required_and_valid_candidate_uses_bounded_evidence(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            with self.assertRaises(HTTPException) as error:
                await ask_coach(example_request())
        self.assertEqual(error.exception.status_code, 503)
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'secret'}), patch('app.routers.coach.generate_answer', return_value='C4 develops faster.') as generate:
            answer = await ask_coach(example_request('Why not C4?'))
        self.assertEqual(answer['answer'], 'C4 develops faster.')
        self.assertEqual(generate.call_args.args[1], 'secret')

    async def test_rejects_invalid_board_and_oversized_history(self):
        request = example_request()
        request.position.board_rows[0] = 'B<script>'
        with self.assertRaises(HTTPException) as error:
            await ask_coach(request)
        self.assertEqual(error.exception.status_code, 422)
        with self.assertRaises(ValidationError):
            CoachRequest.model_validate({
                'question': 'What now?', 'position': example_request().position.model_dump(),
                'history': [{'role': 'user', 'content': 'hello'}] * 7,
            })

    async def test_generation_keeps_api_key_server_side_and_disables_storage(self):
        output = {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'Play C4.'}]}]}
        response = io.BytesIO(json.dumps(output).encode())
        with patch('app.routers.coach.urlopen') as open_url:
            open_url.return_value.__enter__.return_value = response
            answer = generate_answer(example_request(), 'private-key', 'gpt-5-mini')
        self.assertEqual(answer, 'Play C4.')
        sent = open_url.call_args.args[0]
        payload = json.loads(sent.data)
        self.assertFalse(payload['store'])
        self.assertEqual(payload['max_output_tokens'], 450)
        self.assertNotIn('private-key', sent.data.decode())
