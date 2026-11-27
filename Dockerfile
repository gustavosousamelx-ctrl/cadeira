# Cadeira: imagem de produção. Node 24 (LTS) executa TypeScript direto, sem etapa de build.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data/pg \
    BACKUP_DIR=/data/backups \
    TRUST_PROXY=1 \
    DEMO=0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
# /data guarda o banco e as cópias de segurança: monte um volume persistente aqui
VOLUME ["/data"]
EXPOSE 3000
# roda como root porque várias hospedagens montam o volume /data com dono root (Railway, Render).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]
