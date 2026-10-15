/** The DDS module built by tools/dds/build.sh (Emscripten's factory). */
export interface DdsModule {
  _dds_init(maxMemoryMB: number): number;
  _dds_solve(trump: number, first: number, trick: number, count: number, holdings: number, suit: number, rank: number, score: number, equals: number): number;
  _dds_table(holdings: number, out: number): number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
}
export default function createDds(options?: object): Promise<DdsModule>;
