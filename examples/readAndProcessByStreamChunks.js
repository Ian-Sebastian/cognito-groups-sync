const { promisify } = require('util');
const sleep = promisify(setTimeout);

const { createReadStream } = require('fs');
const { parseStream } = require('@fast-csv/parse');

async function someAsyncOperationToDoWithThoseChunks(id) {
  console.log('starting async operation');
  return new Promise(async (Resolve, Reject) => {
    // console.log('stored document', id);
    // await sleep(8000);
    Resolve('Cool, Im a returned value from the async op');
  });
  // This could also be rewritten like
  // await sleep(8000)
  // return 'Cool, Im a returned value from the async op'
}

async function run() {
  const stream = createReadStream('../data/401_users.csv');
  let chunksToProcess = [];
  let counter = 0;
  for await (let chunk of parseStream(stream, { headers: true })) {
    // console.log(process.memoryUsage());
    console.log(chunk);
    chunksToProcess.push(chunk);
    if (chunksToProcess.length === 5) {
      console.log('--> brackpessuring');
      console.log('Processing following chunks');
      console.log(chunksToProcess);
      const bla = await someAsyncOperationToDoWithThoseChunks(5);
      console.log(bla);
      console.log('drainning stream chunks');
      chunksToProcess = [];
    }
    await sleep(1000);
    console.log(`Finishing iteration ${counter}`);
    counter++;
  }
  console.log(`${counter} processes`);
}

run();
