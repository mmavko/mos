const fs = require("fs");
const {Readable} = require("stream");

const pics = require("pics");
const concat = require("concat-frames");
const ColorTransform = require("color-transform");
const resize = require("resizer-stream");

// register some image codecs
pics.use(require("gif-stream"));
pics.use(require("jpg-stream"));
pics.use(require("png-stream"));

const COLOR_SPACE = "rgb";
const COLOR_COMPONENTS = 3;

const TILE_SIZE = 20;
const TILE_COUNT = 30; // larger side

const image1 = "./images/3056964568_0962e9649a_o.jpg";

const fileToStream = fileName =>
  fs
    .createReadStream(fileName)
    .pipe(pics.decode())
    .pipe(new ColorTransform(COLOR_SPACE));

const streamToFile = (stream, fileName) =>
  stream.pipe(pics.encode("image/jpeg")).pipe(fs.createWriteStream(fileName));

// image = {
//   width: 1024,
//   height: 803,
//   colorSpace: "rgb",
//   pixels:
//     <Buffer 6f 81 8d 6f 81 8d 6f 81 8d 81 ... 2466766 more bytes>,
// };

const streamToImage = stream =>
  new Promise(resolve => stream.pipe(concat(frames => resolve(frames[0]))));

const imageToStream = ({width, height, pixels}) => {
  const readable = new Readable();
  readable._read = function() {
    this.emit("format", {width, height, colorSpace: COLOR_SPACE});
    this.push(pixels);
    this.push(null);
  };
  return readable;
};

const adjustSize = image => {
  const {width, height, pixels} = image;
  const largerSide = Math.max(width, height);
  const smallerSide = Math.min(width, height);
  const newLargerSide = TILE_SIZE * TILE_COUNT;
  const newSmallerSide = Math.round((smallerSide * newLargerSide) / largerSide);

  const newWidth = width >= height ? newLargerSide : newSmallerSide;
  const newHeight = height > width ? newLargerSide : newSmallerSide;

  return streamToImage(
    imageToStream(image).pipe(
      resize({
        width: newWidth,
        height: newHeight,
        fit: false,
        allowUpscale: true,
      }),
    ),
  );
};

main();

async function main() {
  // read input file

  const original = await streamToImage(fileToStream(image1));

  // resize input image to mosaic size

  const resized = await adjustSize(original);

  // mosaify
  //   - split mosaic to elements
  //   - generate tiles for substitution
  //   - replace each tile with best match
  //   - concatenate all elements into single image

  // store resulting mosaic image

  streamToFile(imageToStream(resized), "out.jpg");
}
