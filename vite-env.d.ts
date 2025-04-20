/// <reference types="vite/client" />
declare module '*.wasm' {
    const value: string;
    export default value;
  }