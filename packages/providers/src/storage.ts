import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface PresignedUploadInput {
  key: string;
  contentType: string;
  byteSize: number;
  expiresInSeconds: number;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface GetObjectResult {
  data: Buffer;
  contentType?: string | undefined;
  byteSize: number;
}

export interface HeadObjectResult {
  exists: boolean;
  byteSize?: number | undefined;
  contentType?: string | undefined;
}

export interface ObjectStore {
  createPresignedUploadUrl(input: PresignedUploadInput): Promise<PresignedUploadResult>;
  getObject(key: string): Promise<GetObjectResult>;
  putObject(key: string, data: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  headObject(key: string): Promise<HeadObjectResult>;
}

export interface S3ObjectStoreConfig {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean | undefined;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3ObjectStoreConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      forcePathStyle: config.forcePathStyle ?? true
    });
  }

  async createPresignedUploadUrl(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.byteSize
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds
    });

    return {
      uploadUrl,
      headers: {
        "Content-Type": input.contentType
      }
    };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`Object '${key}' not found or body is empty.`);
    }

    const byteArray = await response.Body.transformToByteArray();
    const data = Buffer.from(byteArray);

    return {
      data,
      contentType: response.ContentType,
      byteSize: data.length
    };
  }

  async putObject(key: string, data: Buffer, contentType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
      ContentLength: data.length
    });

    await this.client.send(command);
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    await this.client.send(command);
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const res = await this.client.send(command);
      return {
        exists: true,
        byteSize: res.ContentLength,
        contentType: res.ContentType
      };
    } catch {
      return { exists: false };
    }
  }
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  async createPresignedUploadUrl(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    await Promise.resolve();
    const uploadUrl = `https://in-memory-s3.local/${encodeURIComponent(input.key)}?expires=${Date.now() + input.expiresInSeconds * 1000}`;
    return {
      uploadUrl,
      headers: {
        "Content-Type": input.contentType
      }
    };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    await Promise.resolve();
    const obj = this.objects.get(key);
    if (!obj) {
      throw new Error(`Object '${key}' not found in InMemoryObjectStore.`);
    }
    return {
      data: obj.data,
      contentType: obj.contentType,
      byteSize: obj.data.length
    };
  }

  async putObject(key: string, data: Buffer, contentType: string): Promise<void> {
    await Promise.resolve();
    this.objects.set(key, { data, contentType });
  }

  async deleteObject(key: string): Promise<void> {
    await Promise.resolve();
    this.objects.delete(key);
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    await Promise.resolve();
    const obj = this.objects.get(key);
    if (!obj) return { exists: false };
    return {
      exists: true,
      byteSize: obj.data.length,
      contentType: obj.contentType
    };
  }
}
