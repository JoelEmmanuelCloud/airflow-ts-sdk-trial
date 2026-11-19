FROM node:22-bookworm-slim AS node

FROM apache/airflow:3.4.0-python3.12
COPY --from=node /usr/local/bin/node /usr/local/bin/node
