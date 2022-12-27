import { TemplateDiff, formatDifferences, diffTemplate } from '@aws-cdk/cloudformation-diff';
import { SpecProviderBase, Template, ConfigBase } from '../specs';
import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import chalk from 'chalk';

interface AWSProvider {
    region: string;
}

interface AWSConfig extends ConfigBase {
    tableWidth?: number;
}

export class SpecProvider extends SpecProviderBase<AWSProvider, AWSConfig> {

    private _client: CloudFormationClient;

    setup() {
        this.client = new CloudFormationClient({ region: this.provider.region });
    }

    public set client(client: CloudFormationClient) {
        this._client = client;
    }

    protected exec(oldTemplate: Template, newTemplate: Template): TemplateDiff {
        let diff = diffTemplate(oldTemplate, newTemplate);
        if (!diff.isEmpty) {
            diff = this.exclude(diff);
            const report = this.report(diff);
            this.generateReport(report);
            const stream = process.stdout;
            if (this.config.tableWidth) {
                stream.columns = this.config.tableWidth;
            }
            formatDifferences(stream, diff);
        } else {
            this.log(chalk.green('There were no differences'));
        }
        return diff;
    }

    report(diff: TemplateDiff): { [key: string]: number } {
        const report = {
            create: 0,
            delete: 0,
            update: 0,
        };
        const changeSet = diff.resources;
        Object.values(changeSet.changes).forEach(change => {
            if (change.isAddition) {
                report.create += 1;
            } else if (change.isRemoval) {
                report.delete += 1;
            } else {
                report.update += 1;
            }
        });
        return report;
    }

    diff(specName: string, newTemplate: Template) {
        const command = new GetTemplateCommand({
            StackName: specName,
            TemplateStage: 'Processed',
        });
        return this._client
            .send(command)
            .then((data) => {
                const oldTemplate = JSON.parse(data.TemplateBody);
                return Promise.resolve(this.exec(oldTemplate, newTemplate));
            })
            .catch((err) => {
                if (err.code === 'ValidationError') {
                    const oldTemplate = {};
                    return Promise.resolve(this.exec(oldTemplate, newTemplate));
                }
                return Promise.reject(err.message);
            });
    }
}
