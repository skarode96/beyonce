import { FixedDataKeyProvider, JayZ } from "@ginger.io/jay-z"
import { DynamoDB } from "aws-sdk"
import crypto from "crypto"
import { Beyonce } from "../../main/dynamo/Beyonce"
import { Song, SongModel, table } from "./models"

export const port = 8000
const isRunningOnCI = process.env.CI_BUILD_ID !== undefined
// When running in the CI env, we run Dynamo in a Docker container. And the host must match the service name defined in codeship-services.yml
// see https://documentation.codeship.com/pro/builds-and-configuration/services/#container-networking
const endpoint = isRunningOnCI
  ? `http://dynamodb:${port}`
  : `http://localhost:${port}`

export async function setup(jayz?: JayZ): Promise<Beyonce> {
  const { tableName } = table
  const client = createDynamoDB()

  // DynamoDB Local runs as an external http server, so we need to clear
  // the table from previous test runs
  const { TableNames: tables } = await client.listTables().promise()
  if (tables !== undefined && tables.indexOf(tableName) !== -1) {
    await client.deleteTable({ TableName: tableName }).promise()
  }

  await client
    .createTable(table.asCreateTableInput("PAY_PER_REQUEST"))
    .promise()

  return createBeyonce(client, jayz)
}

export function createDynamoDB(): DynamoDB {
  return new DynamoDB({
    endpoint,
    region: "us-west-2" // silly, but still need to specify region for LocalDynamo
  })
}

export function createBeyonce(db: DynamoDB, jayz?: JayZ): Beyonce {
  return new Beyonce(table, db, { jayz })
}

export async function createJayZ(): Promise<JayZ> {
  const keyProvider = await FixedDataKeyProvider.forLibsodium()
  const jayz = new JayZ({ keyProvider })
  await jayz.ready
  return jayz
}

// DynamoDB has a 400kb Item limit w/ a 1MB response size limit
// Thus 25 song items comprise at least 100kb * 25 = ~2.5MB of data
// i.e. at least 3 pages. Note that data encrypted with JayZ is significantly larger
const mp3 = crypto.randomBytes(100_000)
const songs: Song[] = [...Array(25).keys()].map((songId) =>
  SongModel.create({
    musicianId: "1",
    id: songId.toString(),
    title: `Song ${songId}`,
    mp3
  })
)
export async function create25Songs(db: Beyonce): Promise<Song[]> {
  // Batch these to avoid DynamoDB local throwing errors about exceeding
  // the max payload size
  await Promise.all([
    db.batchWriteWithTransaction({ putItems: songs.slice(0, 5) }),
    db.batchWriteWithTransaction({ putItems: songs.slice(5, 10) }),
    db.batchWriteWithTransaction({ putItems: songs.slice(10, 15) }),
    db.batchWriteWithTransaction({ putItems: songs.slice(15) })
  ])
  return songs
}
