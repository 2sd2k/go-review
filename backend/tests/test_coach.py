import asyncio
import io
import json
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.coach import CoachRequest, ask_coach, coach_instructions, generate_answer, teaching_level
from app.models.schemas import SuggestedMove


def model_message(teaching, uncertainty='This depends on further play.'):
    return {'output': [{'type': 'message', 'content': [{'type': 'output_text',
        'text': json.dumps({'teaching_explanation': teaching, 'uncertainty': uncertainty})}]}]}


def example_request(question='Why was this move bad?', with_context=False):
    payload = {
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
    }
    if with_context:
        payload['game_context'] = {
            'moves': [['B', 'A9']], 'initial_stones': [], 'rules': 'chinese',
            'komi': 7.5, 'board_size': 9, 'max_visits': 100,
        }
    return CoachRequest.model_validate(payload)


class CoachTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_candidate_does_not_call_model(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'secret'}), patch('app.routers.coach.generate_answer') as generate:
            answer = await ask_coach(example_request('Why not C3?'))
        self.assertIn('has not evaluated', answer['teaching_explanation'])
        self.assertIn('deeper analysis', answer['uncertainty'])
        self.assertIn('KataGo preferred C4', ' '.join(answer['engine_facts']))
        generate.assert_not_called()

    async def test_key_is_required_and_valid_candidate_uses_bounded_evidence(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            with self.assertRaises(HTTPException) as error:
                await ask_coach(example_request())
        self.assertEqual(error.exception.status_code, 503)
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'secret'}), patch('app.routers.coach.generate_answer', return_value=('C4 develops faster.', 'The sequence may change.', [])) as generate:
            answer = await ask_coach(example_request('Why not C4?'))
        self.assertEqual(answer['teaching_explanation'], 'C4 develops faster.')
        self.assertEqual(answer['uncertainty'], 'The sequence may change.')
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
        output = model_message('Play C4.')
        response = io.BytesIO(json.dumps(output).encode())
        with patch('app.routers.coach.urlopen') as open_url:
            open_url.return_value.__enter__.return_value = response
            answer, uncertainty, facts = await generate_answer(example_request(), 'private-key', 'gpt-5-mini')
        self.assertEqual(answer, 'Play C4.')
        self.assertEqual(uncertainty, 'This depends on further play.')
        self.assertEqual(facts, [])
        sent = open_url.call_args.args[0]
        payload = json.loads(sent.data)
        self.assertFalse(payload['store'])
        self.assertEqual(payload['max_output_tokens'], 450)
        self.assertEqual(payload['text']['format']['name'], 'coach_explanation')
        self.assertNotIn('private-key', sent.data.decode())

    async def test_missing_candidate_uses_one_focused_search_and_replays_tool_output(self):
        first = {'output': [{'type': 'function_call', 'name': 'analyze_candidate',
                             'call_id': 'call_1', 'arguments': json.dumps({
                                 'move': 'C3', 'where': 'before', 'continuation': [],
                             })}]}
        second = model_message('C3 is worth considering.')
        candidate = SuggestedMove(move='C3', win_rate=0.51, score_lead=1.2, visits=80, pv=['C3', 'D3'])
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'secret'}), \
                patch('app.routers.coach.call_model', side_effect=[first, second]) as model, \
                patch('app.routers.coach.engine.analyze_candidate', return_value=candidate) as search:
            answer = await ask_coach(example_request('Why not C3?', with_context=True))
        self.assertEqual(answer['teaching_explanation'], 'C3 is worth considering.')
        self.assertIn('C3', answer['engine_facts'][-2])
        self.assertEqual(search.call_args.kwargs['moves'], [])
        self.assertEqual(search.call_args.kwargs['max_visits'], 100)
        self.assertEqual(model.call_count, 2)
        followup = model.call_args_list[1].args[0]
        self.assertFalse(followup['store'])
        self.assertEqual(followup['tool_choice'], 'none')
        self.assertEqual(followup['input'][-1]['type'], 'function_call_output')

    async def test_rejects_mismatched_game_sequence_before_model_call(self):
        request = example_request(with_context=True)
        request.game_context.moves[0] = ('B', 'B9')
        with patch('app.routers.coach.call_model') as model:
            with self.assertRaises(HTTPException) as error:
                await ask_coach(request)
        self.assertEqual(error.exception.status_code, 422)
        model.assert_not_called()

    async def test_can_search_short_deeper_variation_but_rejects_long_one(self):
        first = {'output': [{'type': 'function_call', 'name': 'analyze_candidate',
                             'call_id': 'call_2', 'arguments': json.dumps({
                                 'move': 'C3', 'where': 'current', 'continuation': ['D4', 'E5'],
                             })}]}
        second = model_message('After that line, C3 is viable.')
        candidate = SuggestedMove(move='C3', win_rate=0.5, score_lead=0, visits=80, pv=['C3'])
        with patch('app.routers.coach.call_model', side_effect=[first, second]), \
                patch('app.routers.coach.engine.analyze_candidate', return_value=candidate) as search:
            answer, _, facts = await generate_answer(example_request(with_context=True), 'secret', 'gpt-5-mini')
        self.assertIn('C3', answer)
        self.assertEqual(search.call_args.kwargs['moves'], [['B', 'A9'], ['W', 'D4'], ['B', 'E5']])
        self.assertIn('D4 → E5', ' '.join(facts))
        first['output'][0]['arguments'] = json.dumps({
            'move': 'C3', 'where': 'current', 'continuation': ['A1'] * 5,
        })
        with patch('app.routers.coach.call_model', return_value=first), \
                patch('app.routers.coach.engine.analyze_candidate') as search:
            with self.assertRaises(HTTPException) as error:
                await generate_answer(example_request(with_context=True), 'secret', 'gpt-5-mini')
        self.assertEqual(error.exception.status_code, 422)
        search.assert_not_called()

    async def test_rejects_unstructured_or_empty_explanation(self):
        for output in ({'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': 'KataGo says C4 wins.'}]}]},
                model_message('', 'No evidence')):
            with self.subTest(output=output), patch('app.routers.coach.call_model', return_value=output):
                with self.assertRaises(HTTPException) as error:
                    await generate_answer(example_request(), 'secret', 'gpt-5-mini')
                self.assertEqual(error.exception.status_code, 502)

    async def test_rank_aware_instructions_and_modes(self):
        request = example_request()
        request.position.player_rank = '14k'
        self.assertEqual(teaching_level(request), 'beginner')
        self.assertIn('avoid unexplained jargon', coach_instructions(request))
        self.assertIn('at most 65 words', coach_instructions(request))
        request.position.player_rank = '3 dan'
        request.mode = 'technical'
        self.assertEqual(teaching_level(request), 'advanced')
        self.assertIn('precise variations', coach_instructions(request))
        self.assertIn('at most 180 words', coach_instructions(request))
        request.level = 'beginner'
        self.assertEqual(teaching_level(request), 'beginner')
        request.position.player_rank = None
        request.level = 'auto'
        self.assertEqual(teaching_level(request), 'intermediate')
        with self.assertRaises(ValidationError):
            CoachRequest.model_validate({**request.model_dump(), 'mode': 'verbose'})

    async def test_selected_style_is_sent_to_model(self):
        request = example_request()
        request.mode = 'technical'
        request.level = 'advanced'
        with patch('app.routers.coach.call_model', return_value=model_message('Consider C4.')) as model:
            await generate_answer(request, 'secret', 'gpt-5-mini')
        instructions = model.call_args.args[0]['instructions']
        self.assertIn('advanced player', instructions)
        self.assertIn('technical', instructions)
