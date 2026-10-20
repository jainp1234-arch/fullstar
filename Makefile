# FullStar developer commands (see CLAUDE.md).
# lint and test skip the parts of the monorepo that do not exist yet.

.DEFAULT_GOAL := help

COMPOSE_FILE  := infra/docker-compose.yml
MVNW          := ./mvnw -B
JAVA_PROJECTS := services/api services/book-reader infra/keycloak/email-otp
PY_PROJECTS   := workers/reading-checker workers/voice-maker
PYTHON        ?= python3

.PHONY: help up down test lint api family studio

help:
	@echo "make up / make down   start / stop local services (docker compose)"
	@echo "make test             all tests"
	@echo "make lint             all linters"
	@echo "make api              run services/api locally"
	@echo "make family           run apps/family-app locally"
	@echo "make studio           run apps/content-studio locally"

up:
	@test -f $(COMPOSE_FILE) || { echo "$(COMPOSE_FILE) is missing (created in step 0.5)"; exit 1; }
	docker compose -f $(COMPOSE_FILE) up -d --wait

down:
	@test -f $(COMPOSE_FILE) || { echo "$(COMPOSE_FILE) is missing (created in step 0.5)"; exit 1; }
	docker compose -f $(COMPOSE_FILE) down

lint:
	@if [ -f package.json ]; then \
		echo "== frontend: eslint + prettier"; \
		npm run lint --if-present && npm run format:check --if-present || exit 1; \
	else echo "-- frontend: no package.json yet, skipped"; fi
	@for p in $(PY_PROJECTS); do \
		if [ -d $$p ]; then \
			echo "== $$p: syntax check"; \
			$(PYTHON) -m compileall -q $$p || exit 1; \
		else echo "-- $$p: not created yet, skipped"; fi; \
	done

test:
	@if [ -f package.json ]; then \
		echo "== frontend: tests"; \
		npm test --if-present || exit 1; \
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
			(cd $$p && $(PYTHON) -m unittest discover -s tests) || exit 1; \
		else echo "-- $$p: no tests yet, skipped"; fi; \
	done

api:
	@test -f services/api/pom.xml || { echo "services/api is missing (created in step 0.3)"; exit 1; }
	$(MVNW) -f services/api/pom.xml spring-boot:run

family:
	@test -f angular.json || { echo "Angular workspace is missing (created in step 0.3)"; exit 1; }
	npx ng serve family-app

studio:
	@test -f angular.json || { echo "Angular workspace is missing (created in step 0.3)"; exit 1; }
	npx ng serve content-studio
