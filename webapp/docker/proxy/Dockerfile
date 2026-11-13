# Allowlist-only forward proxy: the claude container's ONLY route out.
FROM alpine:3.20
RUN apk add --no-cache squid
COPY squid.conf /etc/squid/squid.conf
COPY entry.sh /entry.sh
ENTRYPOINT ["sh", "/entry.sh"]
