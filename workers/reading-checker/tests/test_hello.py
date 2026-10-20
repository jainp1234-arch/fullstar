import unittest

from reading_checker import NAME


class HelloTest(unittest.TestCase):
    def test_name(self) -> None:
        self.assertEqual(NAME, "reading-checker")


if __name__ == "__main__":
    unittest.main()
