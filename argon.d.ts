export {};

declare global {
  interface IArgon {
    get isArgonHost(): boolean;
    get isArgonHost_MacOs(): boolean;
    get isArgonHost_Windows(): boolean;
    get isArgonHost_Mobile(): boolean;
  }
 
  var argon: IArgon;
}
