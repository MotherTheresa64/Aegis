.PHONY: up down logs api-test web-test lint

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

api-test:
	docker compose run --rm api pytest

web-test:
	docker compose run --rm web npm test -- --run

lint:
	docker compose run --rm api ruff check app tests
	docker compose run --rm web npm run lint
