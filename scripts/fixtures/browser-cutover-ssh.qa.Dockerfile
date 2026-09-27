FROM holaday-first-cutover-age:qa
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server openssh-client && rm -rf /var/lib/apt/lists/*
