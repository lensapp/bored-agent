/**
 * Removes bytes from the beginning of the buffers array.
 * If bytes to be removed is less than the buffer length, the bytes are removed from the start
 * of the buffer.
 * @param buffers Array of buffers to reduce
 * @param bytes Number of bytes to remove.
 * @returns 
 */
export const removeBytesFromBuffersHead = (buffers: Buffer[], bytes: number) => {
  let bytesToRemove = bytes;

  while (bytesToRemove > 0 && buffers.length > 0) {
    const firstBuffer = buffers[0];

    if (bytesToRemove < firstBuffer.length) {
      // Remove 'bytesToRemove' from the start of the last buffer
      buffers[0] = firstBuffer.subarray(bytesToRemove);

      bytesToRemove = 0;
    } else {
      buffers.shift();
      bytesToRemove -= firstBuffer.length;
    }
  }

  return buffers;
};
