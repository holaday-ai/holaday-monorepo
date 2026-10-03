FROM holaday-first-cutover-task3:qa
RUN apt-get update && apt-get install -y --no-install-recommends nftables
