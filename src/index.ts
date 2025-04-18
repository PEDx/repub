import { parse } from "./epub/epubCFI";

const cfi = parse('epubcfi(/6/4[chap0^]!/1ref^^]!/4[body01^^]/10[para^]^,05^^])');
// const cfi = parse('epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/3:10)');

console.log(cfi);
