import { JSONPath } from 'jsonpath-plus';
import { writeFile } from 'fs/promises';

export interface Template {
    [key: string]: any  // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ConfigBase {
    excludes?: string[]
    reportPath?: string
}

export interface Provider {
    diff: (specName: string, newTemplate: Template) => void;
}

export abstract class SpecProviderBase<ServerlessProvider, Config extends ConfigBase> implements Provider {
    protected config: Config;
    protected provider: ServerlessProvider;
    protected log: (msg: string) => void;

    abstract diff(specName: string, newTemplate: Template): void;
    protected abstract setup();

    constructor(provider: ServerlessProvider, config: Config, log: (msg: string) => void) {
        this.provider = provider;
        this.config = config;
        this.log = log;
        this.setup();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected exclude(input: any): any {
        const data = Object.assign({}, input);
        const excludes = this.config.excludes || [];
        excludes.forEach((exclude) => {
            const result = JSONPath({
                resultType: 'all',
                json: data,
                path: exclude,
            });
            result.forEach((res) => {
                delete res.parent[res.parentProperty];
            });
        });
        return data;
    }

    protected generateReport(report: Template) {
        const reportPath = this.config.reportPath;

        if (reportPath) {
            writeFile(reportPath, JSON.stringify(report, null, 4));
        }
    }
}