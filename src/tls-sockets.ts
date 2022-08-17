import { TLSSocket } from "tls";

export class TLSSockets {
  private sockets: TLSSocket[] = [];

  get(): TLSSocket[] {
    return this.sockets;
  }

  push(socket: TLSSocket) {
    this.sockets.push(socket);
  }

  replace(sockets: TLSSocket[]) {
    this.sockets = [...sockets];
  }
}
