export const getArg = (index: number) => process.argv.slice(2)[index]

export const timeout = async (milliseconds: number, log = false) => {
  if (log) {
    console.log(`Waiting for ${milliseconds / 1000} seconds...`)
  }

  await new Promise((r) => setTimeout(r, milliseconds))
}

export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunked: T[][] = []
  let index = 0

  while (index < array.length) {
    chunked.push(array.slice(index, size + index))
    index += size
  }

  return chunked
}
