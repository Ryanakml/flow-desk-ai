import { describe, expect, it } from "vitest";
import { InMemoryObjectStore } from "./storage.js";

describe("Object Storage Adapter (M3-06)", () => {
  it("stores, retrieves, and heads objects in InMemoryObjectStore", async () => {
    const store = new InMemoryObjectStore();
    const key = "org-1/quarantine/att-1/token";
    const data = Buffer.from("File binary content");

    await store.putObject(key, data, "text/plain");

    const head = await store.headObject(key);
    expect(head.exists).toBe(true);
    expect(head.byteSize).toBe(data.length);
    expect(head.contentType).toBe("text/plain");

    const retrieved = await store.getObject(key);
    expect(retrieved.data.toString()).toBe("File binary content");
    expect(retrieved.byteSize).toBe(data.length);
  });

  it("deletes objects cleanly", async () => {
    const store = new InMemoryObjectStore();
    const key = "test/file.txt";
    await store.putObject(key, Buffer.from("data"), "text/plain");

    await store.deleteObject(key);
    const head = await store.headObject(key);
    expect(head.exists).toBe(false);

    await expect(store.getObject(key)).rejects.toThrow();
  });

  it("creates presigned upload URL with headers", async () => {
    const store = new InMemoryObjectStore();
    const presigned = await store.createPresignedUploadUrl({
      key: "org-1/quarantine/att-2/upload.jpg",
      contentType: "image/jpeg",
      byteSize: 1024,
      expiresInSeconds: 900
    });

    expect(presigned.uploadUrl).toContain("org-1%2Fquarantine%2Fatt-2%2Fupload.jpg");
    expect(presigned.headers["Content-Type"]).toBe("image/jpeg");
  });
});
