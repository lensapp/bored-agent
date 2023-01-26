FROM node:19-alpine as build

RUN mkdir /app
WORKDIR /app
COPY . /app
RUN apk add --update gcc g++ make python3 && \
    yarn install --frozen-lockfile && \
    yarn dist && \
    yarn install --frozen-lockfile --prod

FROM node:19-alpine

RUN mkdir /app
WORKDIR /app
COPY package.json yarn.lock ./
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

ENTRYPOINT [ "/usr/local/bin/node" ]
CMD ["/app/dist/index.js"]
