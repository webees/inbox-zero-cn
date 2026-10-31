import { initDataset, type Dataset } from "braintrust";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("braintrust");

// 用于 eval。生产环境不使用。
export class Braintrust {
  private readonly dataset: Dataset | null = null;

  constructor(dataset: string) {
    if (process.env.BRAINTRUST_API_KEY) {
      this.dataset = initDataset("inbox-zero", { dataset });
    }
  }

  insertToDataset(data: { id: string; input: unknown; expected?: unknown }) {
    if (!this.dataset) return;

    try {
      this.dataset.insert(data);
    } catch (error) {
      logger.error("写入 Braintrust 数据集失败", { error });
    }
  }
}
