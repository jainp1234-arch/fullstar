import unittest

from voice_maker import NAME


class HelloTest(unittest.TestCase):
    def test_name(self) -> None:
        self.assertEqual(NAME, "voice-maker")


if __name__ == "__main__":
    unittest.main()
