namespace my;

using {
  cuid,
  sap.common.CodeList
} from '@sap/cds/common';

//using sap from '@sap/cds/common';

type TechnicalBooleanFlag : Boolean @(
  UI.Hidden,
  Core.Computed
);

@cds.persistence.skip
entity Environments : CodeList {
      @(Common: {
        Text           : name,
        TextArrangement: #TextOnly
      })
  key code : String enum {
        Test       = 'T';
        Production = 'P';
      }
};

@cds.persistence.skip
entity Certificates {
  key GUID                    : UUID;
      alias                   : String;
      domain                  : String;
      status                  : String;
      date_begin              : DateTime;
      date_end                : DateTime;
      expiration_severity     : String;
      expiration_days         : Integer;
      expiration_percent      : Integer;
      expired                 : Boolean;
      isRecreatable           : TechnicalBooleanFlag not null default false;
      isCertificateCreateable : TechnicalBooleanFlag not null default false;
      isActivateable          : TechnicalBooleanFlag not null default false;
      isDeactivateable        : TechnicalBooleanFlag not null default false;
      isDeleteable            : TechnicalBooleanFlag not null default false;
      criticality             : Integer;
      route_path              : String;
      isRouteComplete         : TechnicalBooleanFlag not null default false;
      hasOnlyOneDomainSAN     : TechnicalBooleanFlag not null default false;
      landscape               : String; // 'cf-eu10', 'cf-eu10-004' etc.

      sans                    : Association to many Domains
                                  on sans.certificate = $self;
}

@cds.persistence.skip
entity CertificateStatuses : CodeList {
  key code : String;
}

@cds.persistence.skip
entity CertificateDomains : CodeList {
  key code : String;
}

@cds.persistence.skip
entity Domains : cuid {
  alias       : String;
  certificate : Association to one Certificates;
}

@cds.persistence.skip
entity Routes : cuid {
  key guid            : UUID;
      domain          : String;
      path            : String;
      url             : String;
      application     : String;
      isRouteComplete : TechnicalBooleanFlag not null default false;
      space_guid      : UUID;
      domain_guid     : UUID;
}
