FROM node:22-bookworm-slim AS build

RUN mkdir /app
WORKDIR /app
COPY . /app
RUN apt-get update -y -q && \
    apt-get upgrade -y -q && \
    apt-get install -y -q gcc g++ make python3 && \
    yarn install --frozen-lockfile && \
    yarn dist && \
    yarn install --frozen-lockfile --prod

FROM node:22-bookworm-slim

RUN apt-get update -y -q && \
    apt-get upgrade -y -q && \
    rm -rf /var/lib/apt/lists/*
RUN mkdir /app
WORKDIR /app
COPY package.json yarn.lock ./
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

ENTRYPOINT [ "/usr/local/bin/node" ]
CMD ["/app/dist/index.js"]
