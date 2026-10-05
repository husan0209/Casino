#!/bin/sh
# Убирает welcome-страницу образа nginx (default.conf: listen 80 default_server),
# чтобы запрос по IP/неизвестному Host не получал дефолтный vhost вместо casino.conf.
# Хук выполняется официальным entrypoint'ом до старта демона — раньше это делалось
# через `command: ['sh','-c', ...]`, из-за чего envsubst шаблонов не запускался вовсе
# (см. комментарий у сервиса nginx в docker-compose.prod.yml).
rm -f /etc/nginx/conf.d/default.conf
