# QA-only inherited tool layout. Build on arm64, never on a production host.
FROM python@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
RUN apt-get update && apt-get install -y --no-install-recommends nginx nftables iproute2 curl xz-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY node-v22.20.0-linux-arm64.tar.xz /tmp/node-qa/node-v22.20.0-linux-arm64.tar.xz
RUN printf '06907b9c088ce62305bc1530e5c1ae1510245114645768f7750c349c5b6fe667  /tmp/node-qa/node-v22.20.0-linux-arm64.tar.xz\n' | sha256sum --check - \
 && mkdir -p /opt/node22 \
 && tar -xJf /tmp/node-qa/node-v22.20.0-linux-arm64.tar.xz --strip-components=1 -C /opt/node22 \
 && rm /tmp/node-qa/node-v22.20.0-linux-arm64.tar.xz
ENV PATH=/opt/node22/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN npm install --global pm2@6.0.14 --fetch-timeout=20000 --fetch-retries=0 \
 && test "$(node --version)" = v22.20.0 \
 && test "$(node -p 'require("/opt/node22/lib/node_modules/pm2/package.json").version')" = 6.0.14
RUN mkdir -p /opt/holaday-monorepo/apps/orchestrator /opt/qa-unrelated /var/lib/holaday \
 && groupadd -g 998 holaday && useradd -u 998 -g 998 -d /var/lib/holaday holaday \
 && chown 998:998 /var/lib/holaday \
 && test ! -e /usr/bin/python3 && ln -s /usr/local/bin/python3 /usr/bin/python3
ENV PM2_HOME=/root/.pm2
