# 纯静态前端：nginx 直接提供页面，所有数据调网关接口
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/frontend
COPY frontend/ /app/frontend/
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]
