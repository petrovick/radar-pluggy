.PHONY: build up down debug start stop restart logs ps login setup watch lanche-feliz

COMPOSE=docker-compose
DEV_COMPOSE=docker-compose -f docker-compose.yml -f docker-compose.dev.yml

build:
	$(COMPOSE) build

# up sobe o estágio runtime (compilado, sem watch, sem debug); watch e debug sobem
# o estágio dev. Como os três compartilham o nome da imagem, --build evita reusar
# a imagem do modo anterior.
up: down
	$(COMPOSE) up -d --build

setup:
	$(DEV_COMPOSE) run --build -w /application radar-pluggy sh -c "npm install && npm run setup"

watch: down
	$(DEV_COMPOSE) up -d --build

down:
	$(DEV_COMPOSE) down --remove-orphans

debug: down
	DEBUG=1 $(DEV_COMPOSE) up -d --build

start:
	$(COMPOSE) start

stop:
	$(COMPOSE) stop

restart: down up

logs:
	$(COMPOSE) logs --tail=10 -f

ps:
	$(COMPOSE) ps

login:
	$(DEV_COMPOSE) run -w /application radar-pluggy sh

# Reset completo: builda, migra, sobe em debug e segue os logs; ao sair (Ctrl-C), limpa
# dist/package-lock.json/node_modules pra próxima subida partir de zero. $(DEV_COMPOSE), não
# $(COMPOSE): sem o bind mount do estágio dev, o rm -rf não alcançaria o host.
lanche-feliz: down build down setup down debug logs
	$(DEV_COMPOSE) run -w /application radar-pluggy sh -c "rm -rf ./dist package-lock.json node_modules"
