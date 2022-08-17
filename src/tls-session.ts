export class TLSSession {
  private session?: Buffer;

  get(): Buffer | undefined {
    return this.session;
  }

  set(session: Buffer) {
    this.session = session;
  }
}
