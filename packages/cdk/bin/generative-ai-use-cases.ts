#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { createStacks } from '../lib/create-stacks';
import { getParams } from '../parameter';

const app = new cdk.App();
const params = getParams(app);
createStacks(app, params);
