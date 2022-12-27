[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)

# Serverless CloudFormation Diff

## Overview

Plugin for Serverless Framework v3.x which compares your local AWS CloudFormation templates built by package command against deployed ones.

# Usage

```bash
serverless diff --stage REPLACEME [--region REPLACEME]
```

![](https://github.com/AndrewChubatiuk/serverless-diff-plugin/blob/master/usage.gif)

# Install

Execute npm install in your Serverless project.

```bash
yarn add -D serverless-diff-plugin
```

Add the plugin to your `serverless.yml` file

```yml
plugins:
  - serverless-diff-plugin
```
