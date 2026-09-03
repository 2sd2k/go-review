import unittest
from unittest.mock import AsyncMock

from pydantic import ValidationError

from app.models.schemas import AnalysisRequest
from app.models.schemas import SuggestedMove
from app.services.katago import KataGoEngine, calculate_move_losses, parse_katago_response


class AnalysisRequestTests(unittest.TestCase):
    def test_accepts_moves_and_handicap_stones(self):
        request = AnalysisRequest(
            moves=[["W", "D4"]],
            initial_stones=[["B", "Q16"], ["B", "D4"]],
            board_size=19,
        )
        self.assertEqual(request.moves, [("W", "D4")])
        self.assertEqual(len(request.initial_stones), 2)

    def test_rejects_invalid_color_and_limits(self):
        with self.assertRaises(ValidationError):
            AnalysisRequest(moves=[["X", "D4"]], board_size=26, max_visits=0)


class KataGoResponseTests(unittest.TestCase):
    def test_preserves_black_perspective_when_white_is_to_move(self):
        result = parse_katago_response(
            {
                "rootInfo": {
                    "currentPlayer": "W",
                    "winrate": 0.7,
                    "scoreLead": 3.5,
                },
                "moveInfos": [
                    {
                        "move": "Q4",
                        "winrate": 0.72,
                        "scoreLead": 4.1,
                        "visits": 10,
                        "pv": ["Q4", "D16"],
                    }
                ],
                "ownership": [0.0] * 361,
            },
            move_number=1,
        )

        self.assertEqual(result.current_player, "W")
        self.assertEqual(result.win_rate, 0.7)
        self.assertEqual(result.score_lead, 3.5)
        self.assertEqual(result.top_moves[0].win_rate, 0.72)

    def test_calculates_losses_from_each_players_perspective(self):
        black_best = SuggestedMove(
            move="Q16", win_rate=0.7, score_lead=5, visits=100, pv=["Q16"]
        )
        black_played = SuggestedMove(
            move="D4", win_rate=0.6, score_lead=2, visits=100, pv=["D4"]
        )
        win_loss, point_loss = calculate_move_losses("B", black_best, black_played)
        self.assertAlmostEqual(win_loss, 0.1)
        self.assertAlmostEqual(point_loss, 3.0)

        white_best = SuggestedMove(
            move="Q16", win_rate=0.3, score_lead=-5, visits=100, pv=["Q16"]
        )
        white_played = SuggestedMove(
            move="D4", win_rate=0.4, score_lead=-2, visits=100, pv=["D4"]
        )
        win_loss, point_loss = calculate_move_losses("W", white_best, white_played)
        self.assertAlmostEqual(win_loss, 0.1)
        self.assertAlmostEqual(point_loss, 3.0)


class PlayedMoveAnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def test_reuses_a_sufficiently_explored_played_move(self):
        engine = KataGoEngine()
        engine._send_query = AsyncMock()
        response = {
            "moveInfos": [
                {"move": "Q16", "order": 0, "winrate": 0.7, "scoreLead": 5, "visits": 70, "pv": ["Q16"]},
                {"move": "D4", "order": 1, "winrate": 0.6, "scoreLead": 2, "visits": 30, "pv": ["D4"]},
            ]
        }

        comparison = await engine._get_played_move_comparison(
            game_id="game",
            turn=0,
            position_response=response,
            moves=[["B", "D4"]],
            initial_stones=[],
            rules="chinese",
            komi=7.5,
            board_size=19,
            max_visits=100,
        )

        self.assertIsNotNone(comparison)
        played, best, win_loss, point_loss = comparison
        self.assertEqual((played.move, best.move), ("D4", "Q16"))
        self.assertAlmostEqual(win_loss, 0.1)
        self.assertEqual(point_loss, 3.0)
        engine._send_query.assert_not_awaited()

    async def test_forces_analysis_when_the_played_move_was_not_explored(self):
        engine = KataGoEngine()
        engine._send_query = AsyncMock(return_value={
            "moveInfos": [
                {"move": "D4", "order": 0, "winrate": 0.6, "scoreLead": 2, "visits": 100, "pv": ["D4", "Q3"]},
            ]
        })
        response = {
            "moveInfos": [
                {"move": "Q16", "order": 0, "winrate": 0.7, "scoreLead": 5, "visits": 100, "pv": ["Q16"]},
            ]
        }

        comparison = await engine._get_played_move_comparison(
            game_id="game",
            turn=0,
            position_response=response,
            moves=[["B", "D4"]],
            initial_stones=[],
            rules="chinese",
            komi=7.5,
            board_size=19,
            max_visits=100,
        )

        self.assertEqual(comparison[0].pv, ["D4", "Q3"])
        query = engine._send_query.await_args.args[0]
        self.assertEqual(query["moves"], [])
        self.assertEqual(query["allowMoves"], [{
            "player": "B",
            "moves": ["D4"],
            "untilDepth": 1,
        }])


if __name__ == "__main__":
    unittest.main()
