# FullStar developer commands (see CLAUDE.md).
# lint and test skip the parts of the monorepo that do not exist yet.

.DEFAULT_GOAL := help

COMPOSE_FILE  := infra/docker-compose.yml
MVNW          := ./mvnw -B
JAVA_PROJECTS := services/api services/book-reader infra/keycloak/email-otp
PY_PROJECTS   := workers/reading-checker workers/voice-maker
PY_IMAGE      := python:3.12.15-slim

# Use a local Python 3.12 when there is one; otherwise run in the Tech Stack image.
ifeq ($(shell python3 -c "import sys; print(sys.version_info[:2] == (3, 12))" 2>/dev/null),True)
py = (cd $(1) && python3 $(2))
else
py = MSYS_NO_PATHCONV=1 docker run --rm -v "$(CURDIR)/$(1):/w" -w /w $(PY_IMAGE) python $(2)
endif

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
			$(call py,$$p,-m compileall -q .) || exit 1; \
		else echo "-- $$p: not created yet, skipped"; fi; \
	done

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
			$(call py,$$p,-m unittest discover -s tests -t .) || exit 1; \
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
