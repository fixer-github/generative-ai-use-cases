# OpenFGA Migration Plan - Phase 1 POC

## Overview

Migration from SpiceDB + EKS to OpenFGA + ECS Fargate for the authorization system.

**Status**: Phase 1 - POC in progress
**Timeline**: Oct 21-27, 2025 (1 week)
**Goal**: Validate OpenFGA on ECS Fargate as viable replacement

## Migration Rationale

### Why Migrate?

1. **Cost Savings**: 75-84% reduction
   - SpiceDB + EKS: $235-310/month
   - OpenFGA + ECS: $49/month

2. **Operational Simplicity**
   - No Kubernetes expertise required
   - Fargate auto-scaling (no cluster management)
   - Simpler Day-2 operations

3. **No Sunk Cost**
   - SpiceDB code written but NOT deployed to production
   - Clean migration opportunity

4. **CNCF Governance**
   - Vendor-neutral, community-driven
   - Better long-term sustainability

## Phase 1 Plan (1 Week POC)

### Day 1: Infrastructure Setup
- ✅ Create migration planning documents
- [ ] Set up CDK infrastructure repo structure
- [ ] Design VPC/networking architecture
- [ ] Define IAM roles and policies
- [ ] Set up parameter store for configuration

### Day 2: OpenFGA Deployment
- [ ] Create OpenFGA ECS Fargate CDK construct
- [ ] Provision RDS PostgreSQL database
- [ ] Create Application Load Balancer
- [ ] Set up security groups and networking
- [ ] Deploy OpenFGA container to Fargate

### Day 3: Database & Monitoring
- [ ] Run database migrations
- [ ] Configure CloudWatch logging
- [ ] Set up CloudWatch metrics
- [ ] Enable OpenFGA metrics endpoint
- [ ] Create sample tenant data

### Day 4: Schema Conversion
- [ ] Convert SpiceDB .zed to OpenFGA DSL
- [ ] Document schema differences
- [ ] Load authorization model via API
- [ ] Create schema conversion script
- [ ] Backfill sample tuples

### Day 5: Permission Testing
- [ ] Create permission check test suite
- [ ] Validate quota caveat logic
- [ ] Test multi-tenant isolation
- [ ] Measure authorization latency
- [ ] Document any gaps or issues

### Day 6: Performance Validation
- [ ] Run load tests (k6 or Locust)
- [ ] Measure P50/P95/P99 latency
- [ ] Test autoscaling behavior
- [ ] Tune Fargate task sizing
- [ ] Optimize OpenFGA configuration

### Day 7: Review & Documentation
- [ ] Summarize findings
- [ ] Cost comparison (actual vs projected)
- [ ] Performance report
- [ ] Risk assessment
- [ ] Go/No-go recommendation for Phase 2

## Architecture Decisions

### Compute: ECS Fargate

**Choice**: Fargate over EC2
- Serverless, no cluster management
- Per-second billing
- Fast horizontal scaling (~500 tasks/min)
- Perfect for bursty GenAI workloads

### Database: RDS PostgreSQL

**Choice**: Aurora Serverless v2 or RDS Multi-AZ
- OpenFGA native support
- Strong consistency guarantees
- Managed backups and patching
- Connection pooling via RDS Proxy (optional)

### Networking

- Private subnets for Fargate tasks
- Public subnets for ALB
- NAT Gateway for outbound traffic
- VPC endpoints for AWS services (optional)

### OpenFGA Configuration

```yaml
datastore:
  engine: postgres
  uri: postgres://user:pass@rds-endpoint:5432/openfga
  max_open_conns: 100

authn:
  method: preshared
  preshared_keys: ["${SECRET_KEY}"]

cache:
  enabled: true
  ttl: 5m

metrics:
  enabled: true
  addr: :2112

playground:
  enabled: false  # Production security
```

### Tenancy Model

**Option 1: Store per Tenant** (Recommended)
- Complete isolation
- Independent schema evolution
- Easier quota management
- Scales to thousands of tenants

**Option 2: Single Store with Tuple Scoping**
- Lower overhead
- Shared schema
- Requires careful tuple design

**Decision**: Start with Store per Tenant for POC

## Key Risks & Mitigations

### 1. Schema Conversion Fidelity

**Risk**: SpiceDB caveats may not map 1:1 to OpenFGA
**Mitigation**:
- Automated conversion script with validation
- Side-by-side authorization tests
- Document any behavioral differences

### 2. Quota Caveat Semantics

**Risk**: OpenFGA conditions may differ from SpiceDB caveats
**Mitigation**:
- Create dedicated unit tests for quota logic
- Consider hybrid approach (DynamoDB pre-check if needed)
- Document fallback strategies

### 3. Performance Variability

**Risk**: Fargate cold starts or DB connection limits
**Mitigation**:
- Pre-scale baseline tasks (min 2)
- Enable OpenFGA caching
- Use RDS Proxy for connection pooling
- Monitor CloudWatch metrics

### 4. Security & Compliance

**Risk**: Misconfigured TLS or public endpoints
**Mitigation**:
- Private networking by default
- ACM-issued certificates on ALB
- Secrets Manager for credentials
- Security group restrictions

### 5. Observability Gaps

**Risk**: Insufficient metrics hamper tuning
**Mitigation**:
- Enable OpenFGA metrics early
- Ship to CloudWatch/Prometheus
- Set up dashboards Day 1
- Alert on high latency/errors

## Success Criteria

### Infrastructure ✅
- [ ] OpenFGA deployed on ECS Fargate
- [ ] RDS PostgreSQL running and connected
- [ ] ALB with TLS termination
- [ ] CloudWatch logging and metrics
- [ ] Autoscaling configured

### Schema Conversion ✅
- [ ] SpiceDB schema converted to OpenFGA DSL
- [ ] Authorization model loaded
- [ ] Sample tuples created
- [ ] Conversion script automated

### Testing ✅
- [ ] Permission checks work correctly
- [ ] Quota caveats validated
- [ ] Multi-tenant isolation verified
- [ ] No authorization bypass bugs

### Performance ✅
- [ ] P99 latency < 100ms for typical requests
- [ ] System handles 100+ req/sec
- [ ] Autoscaling responds to load
- [ ] Cost projections validated

### Documentation ✅
- [ ] Performance report delivered
- [ ] Cost comparison (actual)
- [ ] Risk assessment updated
- [ ] Phase 2 backlog defined

## File Structure

```
packages/cdk/lib/construct/openfga/
├── openfga-service.ts          # ECS Fargate service
├── openfga-database.ts         # RDS PostgreSQL
├── openfga-alb.ts              # Application Load Balancer
└── index.ts                    # Exports

packages/cdk/lib/construct/authorization/
├── authorization-system.ts     # Main construct (updated for OpenFGA)
└── plan-quota-store.ts         # DynamoDB (unchanged)

packages/cdk/lambda/authorizer/
├── openfga-authorizer.ts       # Lambda Authorizer (new)
└── package.json                # OpenFGA SDK dependency

docs/ja/
├── OPENFGA_MIGRATION_PLAN.md   # This file
├── openfga-schema.fga          # Converted schema
└── openfga-deployment.md       # Deployment guide
```

## Cost Projections

### Phase 1 POC Costs (1 week)
- ECS Fargate (2 tasks × 0.25 vCPU): ~$0.50/day = $3.50/week
- RDS db.t4g.micro: ~$0.50/day = $3.50/week
- ALB: ~$0.50/day = $3.50/week
- Data transfer: ~$1/week
**Total POC**: ~$12 for 1 week

### Production Monthly Costs (projected)
- ECS Fargate (2-4 tasks autoscaling): $18-36/month
- RDS db.t4g.micro (Multi-AZ): $30/month
- ALB: $16/month
- Data transfer: $5/month
**Total**: ~$69-87/month

**Savings vs SpiceDB+EKS**: $165-241/month (71-78%)

## Next Steps After Phase 1

### Phase 2: Full Implementation (2-3 weeks)
- Rewrite all Lambda functions for OpenFGA
- Update CDK constructs
- Comprehensive testing
- Documentation updates

### Phase 3: Production Deployment (1-2 weeks)
- Staging environment deployment
- Load testing at scale
- Security audit
- Production rollout

## References

- [OpenFGA Documentation](https://openfga.dev/docs)
- [OpenFGA Production Best Practices](https://openfga.dev/docs/best-practices/running-in-production)
- [ECS Fargate Security](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-fargate.html)
- [OpenFGA GitHub](https://github.com/openfga/openfga)
