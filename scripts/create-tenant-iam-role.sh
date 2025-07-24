#!/bin/bash

# Simple IAM Role Creation Script for AssumeRoleWithWebIdentity
# Creates just the IAM role without additional infrastructure

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -p, --provider-arn ARN       Identity provider ARN (required)"
    echo "  -a, --audience ID            Audience/Client ID (required)"
    echo "  -c, --claim NAME             Tenant ID claim name (default: custom:tenant_id)"
    echo "  -n, --role-name NAME         IAM role name (optional)"
    echo "  -s, --stack-name NAME        CloudFormation stack name (default: TenantIamRoleStack)"
    echo "  -r, --region REGION          AWS region (default: current region)"
    echo "  -h, --help                   Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Cognito User Pool"
    echo "  $0 -p arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXXX -a client-id"
    echo ""
    echo "  # Custom OIDC Provider"
    echo "  $0 -p arn:aws:iam::123456789012:oidc-provider/example.com -a my-app"
}

# Parse command line arguments
PROVIDER_ARN=""
AUDIENCE=""
CLAIM="custom:tenant_id"
ROLE_NAME=""
STACK_NAME="TenantIamRoleStack"
REGION=$(aws configure get region || echo "us-east-1")

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--provider-arn)
            PROVIDER_ARN="$2"
            shift 2
            ;;
        -a|--audience)
            AUDIENCE="$2"
            shift 2
            ;;
        -c|--claim)
            CLAIM="$2"
            shift 2
            ;;
        -n|--role-name)
            ROLE_NAME="$2"
            shift 2
            ;;
        -s|--stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

# Validate required parameters
if [ -z "$PROVIDER_ARN" ]; then
    echo -e "${RED}Error: Identity provider ARN is required${NC}"
    print_usage
    exit 1
fi

if [ -z "$AUDIENCE" ]; then
    echo -e "${RED}Error: Audience ID is required${NC}"
    print_usage
    exit 1
fi

# Check prerequisites
echo -e "${GREEN}Checking prerequisites...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

if ! command -v cdk &> /dev/null; then
    echo -e "${RED}Error: AWS CDK is not installed. Install with: npm install -g aws-cdk${NC}"
    exit 1
fi

# Get AWS account
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: AWS credentials not configured${NC}"
    exit 1
fi

echo -e "${GREEN}Configuration:${NC}"
echo "  AWS Account: $AWS_ACCOUNT"
echo "  AWS Region: $REGION"
echo "  Identity Provider ARN: $PROVIDER_ARN"
echo "  Audience: $AUDIENCE"
echo "  Tenant ID Claim: $CLAIM"
echo "  Stack Name: $STACK_NAME"
[ -n "$ROLE_NAME" ] && echo "  Role Name: $ROLE_NAME"

# Deploy the stack
echo -e "\n${GREEN}Deploying IAM role...${NC}"

cd packages/cdk

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${GREEN}Installing dependencies...${NC}"
    npm install
fi

# Bootstrap CDK if needed
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION &> /dev/null; then
    echo -e "${GREEN}Bootstrapping CDK...${NC}"
    cdk bootstrap aws://${AWS_ACCOUNT}/${REGION}
fi

# Build the CDK parameters
CDK_PARAMS="--parameters IdentityProviderArn=$PROVIDER_ARN --parameters Audience=$AUDIENCE"

# Deploy the stack
if [ -n "$ROLE_NAME" ]; then
    cdk deploy $STACK_NAME $CDK_PARAMS \
        --context roleName="$ROLE_NAME" \
        --context tenantIdClaim="$CLAIM" \
        --region $REGION \
        --require-approval never
else
    cdk deploy $STACK_NAME $CDK_PARAMS \
        --context tenantIdClaim="$CLAIM" \
        --region $REGION \
        --require-approval never
fi

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}Deployment successful!${NC}"
    
    # Get the role ARN
    ROLE_ARN=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`TenantIamRoleRoleArn`].OutputValue' \
        --output text)
    
    echo -e "\n${GREEN}IAM Role ARN:${NC} $ROLE_ARN"
    
    # Save configuration
    cat > tenant-iam-role-config.json <<EOF
{
  "roleArn": "$ROLE_ARN",
  "identityProviderArn": "$PROVIDER_ARN",
  "audience": "$AUDIENCE",
  "tenantIdClaim": "$CLAIM",
  "region": "$REGION",
  "stackName": "$STACK_NAME"
}
EOF
    
    echo -e "\n${GREEN}Configuration saved to:${NC} tenant-iam-role-config.json"
    
    # Show example usage
    echo -e "\n${GREEN}Example usage:${NC}"
    echo "aws sts assume-role-with-web-identity \\"
    echo "  --role-arn $ROLE_ARN \\"
    echo "  --role-session-name tenant-session \\"
    echo "  --web-identity-token \$TOKEN"
else
    echo -e "\n${RED}Deployment failed!${NC}"
    exit 1
fi