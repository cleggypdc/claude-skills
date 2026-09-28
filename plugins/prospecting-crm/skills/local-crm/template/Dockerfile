# Official PHP CLI image already ships pdo_sqlite. Override with --build-arg PHP_IMAGE=mirror.gcr.io/library/php:8.4-cli-alpine if Docker Hub rate-limits you.
ARG PHP_IMAGE=php:8.4-cli-alpine
FROM ${PHP_IMAGE}

WORKDIR /app
COPY public ./public
COPY src ./src
COPY bin ./bin
COPY config ./config
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Config edits must apply without a restart, so no opcode cache (the app is tiny).
RUN echo "opcache.enable=0" > "$PHP_INI_DIR/conf.d/zz-crm.ini" \
    && chmod +x /usr/local/bin/entrypoint.sh && php -m | grep -q pdo_sqlite && mkdir -p /app/data && chmod 0777 /app/data

ENV CRM_DB=/app/data/crm.db
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8765/ >/dev/null || exit 1
ENTRYPOINT ["entrypoint.sh"]
# 0.0.0.0 inside the container; compose publishes it on 127.0.0.1 only.
CMD ["php", "-S", "0.0.0.0:8765", "-t", "public"]
