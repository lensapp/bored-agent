FROM node:21-bullseye-slim as build

RUN mkdir /app
WORKDIR /app
COPY . /app
RUN apt-get update -y -q && apt-get install -y -q gcc g++ make python3 && \
    yarn install --frozen-lockfile && \
    yarn dist && \
    yarn install --frozen-lockfile --prod

FROM node:21-bullseye-slim

RUN mkdir /app
WORKDIR /app
COPY package.json yarn.lock ./
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

ENTRYPOINT [ "/usr/local/bin/node" ]
CMD ["/app/dist/index.js"]
