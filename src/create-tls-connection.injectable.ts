import { getInjectable } from "@ogre-tools/injectable";
import { connect } from "tls";

const createTLSConnectionInjectable = getInjectable({
  id: "create-tls-connection",
  instantiate: () => connect
});

export default createTLSConnectionInjectable;
