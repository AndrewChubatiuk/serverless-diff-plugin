import { readFile } from 'fs/promises';
import { join } from 'path';
import { Provider } from './specs'

interface ServerlessProvider {
    naming: {
        getCompiledTemplateFileName: () => string;
        getStackName: () => string;
    }
}

interface Serverless {
    getProvider: (name: string) => ServerlessProvider;
    serviceDir: string,
    cli: {
        log: (msg: string) => void;
    },
    pluginManager: {
        spawn: (cmd: string) => void
    },
    service: {
        package: {
            path: string,
        }
        custom: {
            diff: object
        },
        provider: {
            name: string
        }
    }
}

class ServerlessPlugin {
    protected serverless: Serverless;
    protected newTemplateFile: string;
    protected specName: string;
    protected _specProvider: Provider;
    protected providerName: string;
    public hooks: object;
    public commands: object;

    constructor(serverless: Serverless) {
        this.serverless = serverless;

        this.commands = {
            diff: {
                usage: 'Compares new AWS CloudFormation templates against old ones',
                lifecycleEvents: ['diff'],
            },
        };

        /* istanbul ignore next */
        this.hooks = {
            'before:diff:diff': async () => {
                await this.load();
                if (!this.serverless.service.package.path) {
                    await this.serverless.pluginManager.spawn('package');
                }
            },
            'diff:diff': this.diff.bind(this),
        };


        this.providerName = this.serverless.service.provider.name;
        if (!this.serverless.getProvider(this.providerName)) {
            const errorMessage = `The specified provider '${this.providerName}' does not exist.`;
            throw new Error(errorMessage)
        }

        const provider = this.serverless.getProvider(this.providerName);
        const newTemplateName = provider.naming.getCompiledTemplateFileName();
        this.newTemplateFile = join(
            this.serverless.serviceDir,
            '.serverless',
            newTemplateName,
        );
        this.specName = provider.naming.getStackName();
    }

    public get specProvider() {
        return this._specProvider;
    }

    async load() {
        this._specProvider = await import(join('providers', this.providerName))
            .then((providerMod) => {
                this.serverless.cli.log(`Loading '${this.providerName}' module`);
                const custom = this.serverless.service.custom;
                const config = custom && custom.diff || {};
                const log = this.serverless.cli.log;
                const provider = this.serverless.getProvider(this.providerName);
                const SpecProvider = providerMod.SpecProvider;
                return Promise.resolve(new SpecProvider(provider, config, log));
            })
            .catch((err) => {
                return Promise.reject(`No '${this.providerName}' spec provider found: ${err.message}`);
            });
    }

    diff() {
        this.serverless.cli.log('Running diff against deployed template');

        return readFile(this.newTemplateFile, 'utf8')
            .then(data => {
                const newTemplate = JSON.parse(data);
                return this._specProvider.diff(this.specName, newTemplate);
            })
            .catch((err) => {
                if (err.code === 'ENOENT') {
                    const errorPrefix = `${this.newTemplateFile} could not be found`;
                    return Promise.reject(errorPrefix);
                }
                return Promise.reject(err.message);
            });
    }
}

export = ServerlessPlugin;
