FROM golang:1.25.1-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /checker .

FROM scratch
COPY --from=build /checker /checker
USER 65532:65532
ENTRYPOINT ["/checker"]
