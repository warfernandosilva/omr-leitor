# Frontend OMR — build Vite + serve Nginx com proxy /api/ para o backend.
# Uso no ZimaOS: single-origin em http://192.168.1.219:8080
# O frontend é buildado com VITE_API_URL='' para usar mesma origem (ver src/utils/api.ts).

FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . ./
# Mesma origem: o nginx faz proxy de /api/ -> backend:8010
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
