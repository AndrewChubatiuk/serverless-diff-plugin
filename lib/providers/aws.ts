import { TemplateDiff, formatDifferences, diffTemplate } from '@aws-cdk/cloudformation-diff';
import { SpecProviderBase, Template, ConfigBase } from '../specs';
import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import chalk from 'chalk';
import { ServerlessError } from '@serverless-components/core'

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

    async diff(specName: string, newTemplate: Template) {
        const command = new GetTemplateCommand({
            StackName: specName,
            TemplateStage: 'Processed',
        });
        try {
            const resp = await this._client.send(command);
            const oldTemplate = JSON.parse(resp.TemplateBody);
            return this.exec(oldTemplate, newTemplate);
        } catch (err) {
            if (err.name === 'ValidationError') {
                const oldTemplate = {};
                return this.exec(oldTemplate, newTemplate);
            }
            throw new ServerlessError(err.message, 'UNKNOWN_ERROR');
        }
    }
}
