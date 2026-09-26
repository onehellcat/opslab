.PHONY: install app-test app-build compose-up compose-down

install:
	npm --prefix app install

app-test:
	npm --prefix app test

app-build:
	npm --prefix app run build

compose-up:
	docker compose up --build

compose-down:
	docker compose down -v
