#!/bin/bash

# Multi-Tenant IAM Deployment Script
# This script deploys the multi-tenant IAM infrastructure using AWS CDK

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is not installed. Please install it with: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 14 or later."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials are not configured. Please run 'aws configure'."
        exit 1
    fi
    
    print_status "All prerequisites met!"
}

# Function to get user input
get_deployment_params() {
    print_status "Configuring deployment parameters..."
    
    # Get AWS account and region
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    AWS_REGION=$(aws configure get region)
    
    print_status "AWS Account: $AWS_ACCOUNT"
    print_status "AWS Region: $AWS_REGION"
    
    # Get identity provider details
    read -p "Enter Identity Provider Type (cognito/custom) [cognito]: " PROVIDER_TYPE
    PROVIDER_TYPE=${PROVIDER_TYPE:-cognito}
    
    if [ "$PROVIDER_TYPE" = "cognito" ]; then
        read -p "Enter Cognito User Pool ID: " USER_POOL_ID
        if [ -z "$USER_POOL_ID" ]; then
            print_error "User Pool ID is required"
            exit 1
        fi
        IDENTITY_PROVIDER_ARN="arn:aws:cognito-idp:${AWS_REGION}:${AWS_ACCOUNT}:userpool/${USER_POOL_ID}"
        IDENTITY_PROVIDER_NAME="cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}"
    else
        read -p "Enter Identity Provider ARN: " IDENTITY_PROVIDER_ARN
        if [ -z "$IDENTITY_PROVIDER_ARN" ]; then
            print_error "Identity Provider ARN is required"
            exit 1
        fi
    fi
    
    read -p "Enter Client/Audience ID: " AUDIENCE_ID
    if [ -z "$AUDIENCE_ID" ]; then
        print_error "Audience ID is required"
        exit 1
    fi
    
    # Optional: Custom tenant ID claim
    read -p "Enter tenant ID claim name [custom:tenant_id]: " TENANT_ID_CLAIM
    TENANT_ID_CLAIM=${TENANT_ID_CLAIM:-custom:tenant_id}
    
    # Stack name
    read -p "Enter stack name [MultiTenantIamStack]: " STACK_NAME
    STACK_NAME=${STACK_NAME:-MultiTenantIamStack}
}

# Function to install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    cd packages/cdk
    npm install
    cd ../..
}

# Function to bootstrap CDK (if needed)
bootstrap_cdk() {
    print_status "Checking CDK bootstrap status..."
    
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit &> /dev/null; then
        print_status "Bootstrapping CDK..."
        cd packages/cdk
        cdk bootstrap aws://${AWS_ACCOUNT}/${AWS_REGION}
        cd ../..
    else
        print_status "CDK already bootstrapped"
    fi
}

# Function to synthesize the stack
synth_stack() {
    print_status "Synthesizing CloudFormation template..."
    
    cd packages/cdk
    cdk synth ${STACK_NAME} \
        --context identityProviderArn="${IDENTITY_PROVIDER_ARN}" \
        --context audience="${AUDIENCE_ID}" \
        --context tenantIdClaim="${TENANT_ID_CLAIM}"
    cd ../..
}

# Function to deploy the stack
deploy_stack() {
    print_status "Deploying stack ${STACK_NAME}..."
    
    cd packages/cdk
    
    if [ "$PROVIDER_TYPE" = "cognito" ]; then
        cdk deploy ${STACK_NAME} \
            --parameters IdentityProviderArn="${IDENTITY_PROVIDER_ARN}" \
            --parameters Audience="${AUDIENCE_ID}" \
            --require-approval never
    else
        cdk deploy ${STACK_NAME} \
            --parameters IdentityProviderArn="${IDENTITY_PROVIDER_ARN}" \
            --parameters Audience="${AUDIENCE_ID}" \
            --require-approval never
    fi
    
    cd ../..
}

# Function to display outputs
display_outputs() {
    print_status "Deployment complete! Here are the important outputs:"
    
    # Get stack outputs
    OUTPUTS=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --query 'Stacks[0].Outputs' \
        --output json)
    
    echo "$OUTPUTS" | jq -r '.[] | "\(.OutputKey): \(.OutputValue)"'
    
    # Save outputs to file
    echo "$OUTPUTS" > deployment-outputs.json
    print_status "Outputs saved to deployment-outputs.json"
}

# Function to create example configuration
create_example_config() {
    print_status "Creating example configuration..."
    
    ROLE_ARN=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --query 'Stacks[0].Outputs[?OutputKey==`TenantRoleArn`].OutputValue' \
        --output text)
    
    TABLE_NAME=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --query 'Stacks[0].Outputs[?OutputKey==`TenantTableName`].OutputValue' \
        --output text)
    
    BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name ${STACK_NAME} \
        --query 'Stacks[0].Outputs[?OutputKey==`TenantBucketName`].OutputValue' \
        --output text)
    
    cat > example-config.json <<EOF
{
  "tenantRoleArn": "${ROLE_ARN}",
  "tableName": "${TABLE_NAME}",
  "bucketName": "${BUCKET_NAME}",
  "identityProvider": {
    "type": "${PROVIDER_TYPE}",
    "arn": "${IDENTITY_PROVIDER_ARN}",
    "audience": "${AUDIENCE_ID}",
    "tenantIdClaim": "${TENANT_ID_CLAIM}"
  },
  "region": "${AWS_REGION}",
  "account": "${AWS_ACCOUNT}"
}
EOF
    
    print_status "Example configuration saved to example-config.json"
}

# Main deployment flow
main() {
    print_status "Starting Multi-Tenant IAM deployment..."
    
    check_prerequisites
    get_deployment_params
    install_dependencies
    bootstrap_cdk
    synth_stack
    deploy_stack
    display_outputs
    create_example_config
    
    print_status "Deployment completed successfully!"
    print_status "Check the documentation at docs/multi-tenant-iam-guide.md for usage examples"
}

# Run main function
main