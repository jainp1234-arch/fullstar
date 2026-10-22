# FullStar developer commands (see CLAUDE.md).
# lint and test skip the parts of the monorepo that do not exist yet.

.DEFAULT_GOAL := help

COMPOSE       := docker compose --env-file .env -f infra/docker-compose.yml
MVNW          := ./mvnw -B
JAVA_PROJECTS := services/api services/book-reader infra/keycloak/email-otp
PY_PROJECTS   := workers/reading-checker workers/voice-maker
PY_IMAGE      := python:3.12.15-slim

# $(call py,<dir>,<command>): run in <dir> with requirements-dev.txt available.
# Uses a local Python 3.12 (with requirements-dev.txt installed) when there is one;
# otherwise runs in the Tech Stack image with a cached pip volume.
ifeq ($(shell python3 -c "import sys; print(sys.version_info[:2] == (3, 12))" 2>/dev/null),True)
py = (cd $(1) && $(2))
else
py = MSYS_NO_PATHCONV=1 docker run --rm -v "$(CURDIR):/w" -v fullstar-pip-cache:/root/.cache/pip \
	-w /w/$(1) $(PY_IMAGE) sh -c "pip install -q --root-user-action=ignore --disable-pip-version-check \
	-r /w/requirements-dev.txt && $(2)"
endif

.PHONY: help up down test lint api book-reader test-ocr test-reading reading-check voice test-voice narrate-check test-pages family studio db-bootstrap db-migrate bootstrap bootstrap-admin seed-content vendor-assets

help:
	@echo "make up / make down   start / stop local services (docker compose)"
	@echo "make test             all tests"
	@echo "make lint             all linters"
	@echo "make api              run services/api locally"
	@echo "make book-reader      rebuild and restart the book-reader worker in compose"
	@echo "make test-ocr         real Tesseract and cwebp of the book-reader image on the sample pages"
	@echo "make family           run apps/family-app locally"
	@echo "make studio           run apps/content-studio locally"
	@echo "make db-bootstrap     create app_owner/app_api/app_system on NEON_OWNER_URL, write .env"
	@echo "make db-migrate       run Flyway migrations as app_owner (DB_MIGRATE_JDBC_URL)"
	@echo "make bootstrap        create the queues + DLQs (and the trial bucket)"
	@echo "make bootstrap-admin EMAIL=you@example.com NAME=\"Your Name\"   make the first Studio super admin"
	@echo "make seed-content     load the Class 3 starter content (infra/seed/class3), checked and published"
	@echo "make test-reading       real reading-checker model on synthetic speech (Docker)"
	@echo "make reading-check DIR= score your own recordings against their passages"
	@echo "make voice             start the voice-maker worker in compose (about 8 GB of memory)"
	@echo "make test-voice        real voice-maker narration of an English and a Hindi page (Docker)"
	@echo "make narrate-check DIR= narrate each page .txt in DIR to an MP3 with Audacity word labels"
	@echo "make vendor-assets    download and convert fonts, icons and illustrations (libs/ui/assets)"

up:
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	$(COMPOSE) up -d --build --wait --wait-timeout 180
	@echo "Local services healthy. App, Studio, /api and /auth: http://localhost:8080"

down:
	$(COMPOSE) down

lint:
	@if [ -f package.json ]; then \
		echo "== frontend: eslint + prettier"; \
		npm run lint --if-present && npm run format:check --if-present || exit 1; \
	else echo "-- frontend: no package.json yet, skipped"; fi
	@echo "== workers: ruff check + ruff format --check"
	@$(call py,.,python3 -m ruff check workers && python3 -m ruff format --check workers)

test:
	@if [ -f package.json ]; then \
		echo "== frontend: unit tests + e2e"; \
		npm test && npm run e2e || exit 1; \
	else echo "-- frontend: no package.json yet, skipped"; fi
	@for p in $(JAVA_PROJECTS); do \
		if [ -f $$p/pom.xml ]; then \
			echo "== $$p: mvn verify"; \
			$(MVNW) -f $$p/pom.xml verify || exit 1; \
		else echo "-- $$p: no pom.xml yet, skipped"; fi; \
	done
	@for p in $(PY_PROJECTS); do \
		if [ -d $$p/tests ]; then \
			echo "== $$p: tests"; \
			$(call py,$$p,python3 -m pytest -q -p no:cacheprovider) || exit 1; \
		else echo "-- $$p: no tests yet, skipped"; fi; \
	done

api:
	@test -f services/api/pom.xml || { echo "services/api is missing (created in step 0.3)"; exit 1; }
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	$(MVNW) -f services/api/pom.xml spring-boot:run -Dspring-boot.run.profiles=local \
		"-Dspring-boot.run.arguments=--spring.config.import=optional:file:$(CURDIR)/.env[.properties]"

# book-reader needs Tesseract and cwebp, which exist only in its image (Plan 5.3): it runs in compose
book-reader:
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	$(COMPOSE) up -d --build --wait book-reader

# The real OCR test: Tesseract and cwebp of the built image read the sample pages
test-ocr:
	docker build -f services/book-reader/Dockerfile -t fullstar/book-reader:local .
	$(MVNW) -f services/book-reader/pom.xml test -Dtest=RealToolsImageTest -Dbookreader.image=fullstar/book-reader:local

# Plan 8.3: the real model in the reading-checker test image scores synthetic speech
test-reading:
	docker build --target test -t fullstar/reading-checker:test workers/reading-checker
	docker run --rm fullstar/reading-checker:test

# Plan 8.3 manual check: scores each recording in DIR against the passage in the .txt of the same name
reading-check:
	@test -n "$(DIR)" || { echo "Usage: make reading-check DIR=<folder with kite.m4a + kite.txt ...>"; exit 1; }
	docker build -t fullstar/reading-checker:local workers/reading-checker
	MSYS_NO_PATHCONV=1 docker run --rm -v "$(abspath $(DIR)):/check:ro" fullstar/reading-checker:local python -m reading_checker.check /check

# Plan 8.2: the voice model is gated; HF_TOKEN from .env reaches the build only as a BuildKit secret
VOICE_BUILD := HF_TOKEN="$$(grep '^HF_TOKEN=' .env | cut -d= -f2- | tr -d '\r')" docker build --secret id=hf_token,env=HF_TOKEN

voice:
	HF_TOKEN="$$(grep '^HF_TOKEN=' .env | cut -d= -f2- | tr -d '\r')" $(COMPOSE) --profile voice up -d --build voice-maker

test-voice:
	$(VOICE_BUILD) --target test -t fullstar/voice-maker:test workers/voice-maker
	docker run --rm fullstar/voice-maker:test

# Plan 8.2 manual check: open each MP3 in Audacity with its labels; every word within 150 ms
narrate-check:
	@test -n "$(DIR)" || { echo "Usage: make narrate-check DIR=<folder with page1.txt page2.txt ...>"; exit 1; }
	$(VOICE_BUILD) -t fullstar/voice-maker:local workers/voice-maker
	MSYS_NO_PATHCONV=1 docker run --rm -v "$(abspath $(DIR)):/check" fullstar/voice-maker:local python -m voice_maker.check /check

# Renders the sample pages of test-ocr (services/book-reader/src/test/resources/pages)
test-pages:
	MSYS_NO_PATHCONV=1 docker run --rm -v "$(CURDIR):/w" -v fullstar-pip-cache:/root/.cache/pip -w /w $(PY_IMAGE) sh -c \
		"apt-get update -qq && apt-get install -y -qq --no-install-recommends libraqm0 && pip install -q --root-user-action=ignore --disable-pip-version-check pillow==12.3.0 fonttools==4.66.1 brotli==1.2.0 && python tools/test-pages/make_pages.py"

db-bootstrap:
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	MSYS_NO_PATHCONV=1 docker run --rm -v "$(CURDIR):/w" postgres:18.6 sh /w/infra/db/bootstrap-roles.sh

vendor-assets:
	MSYS_NO_PATHCONV=1 docker run --rm -v "$(CURDIR):/w" -w /w python:3.12.15-slim sh -c \
		"pip install -q --root-user-action=ignore --disable-pip-version-check -r tools/vendor-assets/requirements.txt && python tools/vendor-assets/vendor.py"
	node tools/vendor-assets/sky-stars.mjs
	node scripts/check-assets.mjs

bootstrap:
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	$(MVNW) -q -f services/api/pom.xml spring-boot:run -Dspring-boot.run.profiles=bootstrap \
		"-Dspring-boot.run.arguments=--spring.config.import=optional:file:$(CURDIR)/.env[.properties]"

db-migrate:
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	$(MVNW) -q -f services/api/pom.xml spring-boot:run -Dspring-boot.run.profiles=migrate \
		"-Dspring-boot.run.arguments=--spring.config.import=optional:file:$(CURDIR)/.env[.properties]"

family:
	@test -f angular.json || { echo "Angular workspace is missing (created in step 0.3)"; exit 1; }
	npx ng serve family-app --host 127.0.0.1 --port 4200

studio:
	@test -f angular.json || { echo "Angular workspace is missing (created in step 0.3)"; exit 1; }
	npx ng serve content-studio --host 127.0.0.1 --port 4201

bootstrap-admin:
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	@test -n "$(EMAIL)" -a -n "$(NAME)" || { echo 'usage: make bootstrap-admin EMAIL=you@example.com NAME="Your Name"'; exit 1; }
	$(MVNW) -q -f services/api/pom.xml spring-boot:run -Dspring-boot.run.profiles=bootstrap-admin \
		"-Dspring-boot.run.arguments=--spring.config.import=optional:file:$(CURDIR)/.env[.properties] --email=$(EMAIL) '--name=$(NAME)'"

seed-content:
	@test -f .env || { echo ".env is missing: copy .env.example to .env and fill in the values"; exit 1; }
	$(MVNW) -q -f services/api/pom.xml spring-boot:run -Dspring-boot.run.profiles=seed-content \
		"-Dspring-boot.run.arguments=--spring.config.import=optional:file:$(CURDIR)/.env[.properties] --dir=$(CURDIR)/infra/seed/class3"
