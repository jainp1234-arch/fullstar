import logging

from voice_maker import NAME

logger = logging.getLogger(NAME)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info("%s started; queue consumer arrives in phase 8", NAME)


if __name__ == "__main__":
    main()
