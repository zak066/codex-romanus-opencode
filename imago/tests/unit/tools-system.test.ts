import { describe, it, expect, vi, beforeEach } from 'vitest';

function createMockServer() {
  const tools = new Map<string, { cb: Function }>();
  return {
    tool: (name: string, _desc: string, _schema: any, cb: Function) => {
      tools.set(name, { cb });
      return { remove: () => tools.delete(name) };
    },
    callTool: async (name: string, args: any) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not found`);
      return tool.cb(args);
    },
  };
}

function createMockDeps() {
  return {
    comfyClient: {
      getSystemStats: vi.fn(),
      getObjectInfo: vi.fn(),
      getEmbeddings: vi.fn(),
    },
  };
}

describe('system tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(async () => {
    server = createMockServer();
    deps = createMockDeps();
    const { registerSystemTools } = await import('../../src/tools/system.js');
    registerSystemTools(server as any, deps as any);
  });

  it('list_models returns models', async () => {
    deps.comfyClient.getObjectInfo.mockResolvedValue({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [] } } },
    });
    const r = await server.callTool('list_models', {});
    const p = JSON.parse(r.content[0].text);
    expect(Array.isArray(p.models)).toBe(true);
  });

  it('list_models with type embeddings', async () => {
    deps.comfyClient.getEmbeddings.mockResolvedValue(['emb1', 'emb2']);
    const r = await server.callTool('list_models', { type: 'embeddings' });
    const p = JSON.parse(r.content[0].text);
    expect(p.models.length).toBe(2);
  });

  it('list_models with type checkpoints', async () => {
    deps.comfyClient.getObjectInfo.mockResolvedValue({
            CheckpointLoaderSimple: { input: { required: { ckpt_name: [['model1.safetensors', 'model2.safetensors'], {}] } } },
    });
    const r = await server.callTool('list_models', { type: 'checkpoints' });
    const p = JSON.parse(r.content[0].text);
    expect(p.models.length).toBe(2);
  });

  it('list_models with type unet', async () => {
    deps.comfyClient.getObjectInfo.mockResolvedValue({
      UnetLoaderGGUF: { input: { required: { model_name: [['flux1-dev.gguf', 'flux1-schnell.gguf'], {}] } } },
      UNETLoader: { input: { required: { unet_name: [['flux1-dev.safetensors'], {}] } } },
    });
    const r = await server.callTool('list_models', { type: 'unet' });
    const p = JSON.parse(r.content[0].text);
    expect(p.models.length).toBe(3);
    expect(p.models[0]).toEqual({ name: 'flux1-dev.gguf', type: 'unet' });
    expect(p.models[1]).toEqual({ name: 'flux1-schnell.gguf', type: 'unet' });
    expect(p.models[2]).toEqual({ name: 'flux1-dev.safetensors', type: 'unet' });
  });

  it('list_models with type unet returns empty array when no unet nodes in objectInfo', async () => {
    deps.comfyClient.getObjectInfo.mockResolvedValue({});
    const r = await server.callTool('list_models', { type: 'unet' });
    const p = JSON.parse(r.content[0].text);
    expect(p.models).toEqual([]);
  });

  it('get_system_stats returns system info', async () => {
    deps.comfyClient.getSystemStats.mockResolvedValue({
      system: { os: 'windows', python_version: '3.12', comfyui_version: '0.3.0', args: {} },
      devices: [{ name: 'RTX4090', type: 'cuda', index: 0, vram_total: 24564, vram_free: 18000, torch_version: '2.5' }],
    });
    const r = await server.callTool('get_system_stats', {});
    const p = JSON.parse(r.content[0].text);
    expect(p.system.os).toBe('windows');
    expect(p.device_count).toBe(1);
  });

  it('get_system_stats handles connection error', async () => {
    deps.comfyClient.getSystemStats.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(server.callTool('get_system_stats', {})).rejects.toThrow();
  });

  it('get_defaults returns empty object with note', async () => {
    const r = await server.callTool('get_defaults', {});
    const p = JSON.parse(r.content[0].text);
    expect(p.defaults).toEqual({});
    expect(p.note).toContain('Not yet implemented');
  });

  it('set_defaults returns updated false', async () => {
    const r = await server.callTool('set_defaults', { key: 'steps', value: 20 });
    const p = JSON.parse(r.content[0].text);
    expect(p.updated).toBe(false);
  });

  it('set_defaults missing key returns gracefully', async () => {
    const r = await server.callTool('set_defaults', { value: 20 });
    const p = JSON.parse(r.content[0].text);
    expect(p.updated).toBe(false);
    expect(p.message).toContain('Not yet implemented');
  });
});
